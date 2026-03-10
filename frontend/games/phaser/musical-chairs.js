registerGame("musical-chairs", "💺 Musical Chairs", "WASD = P1, Arrows = P2", "Grab a chair when the music stops!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2e1a2e");
    this.p1=this.add.circle(200,H/2,16,0xf7c948);this.p2=this.add.circle(W-200,H/2,16,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.collider(this.p1,this.p2);
    this.chairs=[];this.chairCount=3;this.round=1;this.s1=0;this.s2=0;
    this.spawnChairs();
    this.msgTxt=this.add.text(W/2,30,"MOVE AROUND! Music playing...",{fontSize:"20px",color:"#4ecca3",fontFamily:"monospace"}).setOrigin(0.5);
    this.sTxt=this.add.text(W/2,H-20,"P1: 0 | P2: 0",{fontSize:"16px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.state="moving";this.over=false;
    this.scheduleStop();
  }
  spawnChairs(){this.chairs.forEach(c=>c.destroy());this.chairs=[];
    for(let i=0;i<this.chairCount;i++){
      const c=this.add.rectangle(Phaser.Math.Between(150,W-150),Phaser.Math.Between(100,H-100),30,30,0x886644).setStrokeStyle(2,0xaa8855);
      this.chairs.push(c);
    }
  }
  scheduleStop(){this.time.delayedCall(Phaser.Math.Between(2000,4000),()=>{
    if(this.over)return;this.state="stopped";this.msgTxt.setText("GRAB A CHAIR!").setColor("#e94560");
    this.time.delayedCall(1500,()=>{if(this.state!=="stopped"||this.over)return;this.resolveRound();});
  });}
  resolveRound(){
    let p1Dist=999,p2Dist=999;
    this.chairs.forEach(c=>{p1Dist=Math.min(p1Dist,Phaser.Math.Distance.Between(this.p1.x,this.p1.y,c.x,c.y));
      p2Dist=Math.min(p2Dist,Phaser.Math.Distance.Between(this.p2.x,this.p2.y,c.x,c.y));});
    if(p1Dist<p2Dist)this.s1++;else this.s2++;
    this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
    if(this.round>=5){this.over=true;this.msgTxt.setText((this.s1>this.s2?"P1":"P2")+" WINS!").setColor("#f7c948").setFontSize(32);return;}
    this.round++;this.chairCount=Math.max(1,this.chairCount-1);this.spawnChairs();
    this.state="moving";this.msgTxt.setText("Music playing...").setColor("#4ecca3");
    this.p1.setPosition(200,H/2);this.p2.setPosition(W-200,H/2);
    this.scheduleStop();
  }
  update(){if(this.over)return;const s=260,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
  }
});
