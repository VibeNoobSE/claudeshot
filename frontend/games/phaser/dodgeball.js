registerGame("dodgeball", "🏐 Dodgeball", "WASD+SPACE = P1, Arrows+ENTER = P2", "Throw balls to hit your opponent", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2a1e");
    this.add.rectangle(W/2,H/2,4,H,0x444444); // center line
    this.p1=this.add.rectangle(100,H/2,24,32,0xf7c948);this.p2=this.add.rectangle(W-100,H/2,24,32,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);p.setData("hp",5);});
    this.balls=this.physics.add.group();
    this.hp1=this.add.text(16,16,"P1: 5 HP",{fontSize:"16px",color:"#f7c948",fontFamily:"monospace"});
    this.hp2=this.add.text(W-130,16,"P2: 5 HP",{fontSize:"16px",color:"#e94560",fontFamily:"monospace"});
    this.physics.add.overlap(this.balls,this.p1,(p,b)=>{if(b.getData("o")==="P1")return;b.destroy();const hp=p.getData("hp")-1;p.setData("hp",hp);this.hp1.setText("P1: "+hp+" HP");if(hp<=0)this.endGame("P2");});
    this.physics.add.overlap(this.balls,this.p2,(p,b)=>{if(b.getData("o")==="P2")return;b.destroy();const hp=p.getData("hp")-1;p.setData("hp",hp);this.hp2.setText("P2: "+hp+" HP");if(hp<=0)this.endGame("P1");});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",space:"SPACE",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.ls1=0;this.ls2=0;this.over=false;
  }
  endGame(winner){this.over=true;this.physics.pause();this.add.text(W/2,H/2,winner+" WINS!",{fontSize:"40px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  update(t){if(this.over)return;const s=220,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    this.p1.x=Math.min(this.p1.x,W/2-20);this.p2.x=Math.max(this.p2.x,W/2+20);
    if(k.space.isDown&&t>this.ls1+400){this.ls1=t;const b=this.add.circle(this.p1.x+20,this.p1.y,6,0xf7c948);this.balls.add(b);this.physics.add.existing(b);b.body.setVelocity(350,Phaser.Math.Between(-100,100));b.setData("o","P1");this.time.delayedCall(3000,()=>b.destroy());}
    if(k.enter.isDown&&t>this.ls2+400){this.ls2=t;const b=this.add.circle(this.p2.x-20,this.p2.y,6,0xe94560);this.balls.add(b);this.physics.add.existing(b);b.body.setVelocity(-350,Phaser.Math.Between(-100,100));b.setData("o","P2");this.time.delayedCall(3000,()=>b.destroy());}
  }
});
