registerGame("tag", "🏷️ Tag", "WASD = P1, Arrows = P2", "Don't be IT when time runs out!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1e1a2e");
    this.p1=this.add.circle(200,H/2,16,0xf7c948);this.p2=this.add.circle(W-200,H/2,16,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.it=0;this.tagCooldown=0;
    this.itTxt=this.add.text(W/2,30,"P1 is IT!",{fontSize:"24px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);
    this.timeLeft=20;
    this.timeTxt=this.add.text(W/2,H-30,this.timeLeft+"s",{fontSize:"20px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){this.physics.pause();const winner=this.it===0?"P2":"P1";this.add.text(W/2,H/2,winner+" WINS!",{fontSize:"40px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}this.timeTxt.setText(this.timeLeft+"s");},loop:true});
    // obstacles
    for(let i=0;i<6;i++) this.add.rectangle(Phaser.Math.Between(100,W-100),Phaser.Math.Between(80,H-80),60,20,0x333355);
    this.physics.add.overlap(this.p1,this.p2,()=>{if(this.tagCooldown>0)return;this.it=this.it===0?1:0;this.tagCooldown=30;this.itTxt.setText((this.it===0?"P1":"P2")+" is IT!");});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
  }
  update(){
    if(this.tagCooldown>0)this.tagCooldown--;
    const itPlayer=this.it===0?this.p1:this.p2;const otherPlayer=this.it===0?this.p2:this.p1;
    itPlayer.fillColor=0xe94560;otherPlayer.fillColor=this.it===0?0xe94560:0xf7c948;
    itPlayer.setScale(1.2);otherPlayer.setScale(1);
    // IT is slightly faster
    const s1=this.it===0?300:260,s2=this.it===1?300:260,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s1:k.d.isDown?s1:0,k.w.isDown?-s1:k.s.isDown?s1:0);
    this.p2.body.setVelocity(k.left.isDown?-s2:k.right.isDown?s2:0,k.up.isDown?-s2:k.down.isDown?s2:0);
  }
});
