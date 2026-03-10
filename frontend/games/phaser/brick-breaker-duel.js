registerGame("brick-breaker-duel", "🧱 Brick Duel", "A/D = P1, ←/→ = P2", "Both sides break bricks — first to clear wins!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a2e");
    this.add.rectangle(W/2,H/2,2,H,0x333355);
    const colors=[0xe94560,0xf7c948,0x4ecca3];
    this.b1=this.physics.add.staticGroup();this.b2=this.physics.add.staticGroup();
    for(let r=0;r<3;r++)for(let c=0;c<6;c++){
      this.b1.add(this.add.rectangle(50+c*60,40+r*25,54,20,colors[r]));
      this.b2.add(this.add.rectangle(W/2+30+c*60,40+r*25,54,20,colors[r]));
    }
    this.pad1=this.add.rectangle(W/4,H-30,80,12,0xf7c948);this.pad2=this.add.rectangle(W*3/4,H-30,80,12,0xe94560);
    [this.pad1,this.pad2].forEach(p=>{this.physics.add.existing(p);p.body.setImmovable(true).setCollideWorldBounds(true);});
    this.ball1=this.add.circle(W/4,H-50,6,0xffffff);this.ball2=this.add.circle(W*3/4,H-50,6,0xffffff);
    [this.ball1,this.ball2].forEach(b=>{this.physics.add.existing(b);b.body.setBounce(1,1).setCollideWorldBounds(true).setVelocity(Phaser.Math.Between(-150,150),-250);});
    this.physics.add.collider(this.ball1,this.pad1,(b)=>{b.body.setVelocityX((b.x-this.pad1.x)*4);});
    this.physics.add.collider(this.ball2,this.pad2,(b)=>{b.body.setVelocityX((b.x-this.pad2.x)*4);});
    this.s1=0;this.s2=0;
    this.physics.add.collider(this.ball1,this.b1,(b,br)=>{br.destroy();this.s1++;if(this.s1>=18)this.win("P1");});
    this.physics.add.collider(this.ball2,this.b2,(b,br)=>{br.destroy();this.s2++;if(this.s2>=18)this.win("P2");});
    this.sTxt=this.add.text(W/2,H-10,"P1: 0/18 | P2: 0/18",{fontSize:"14px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",left:"LEFT",right:"RIGHT"});this.over=false;
  }
  win(who){if(this.over)return;this.over=true;this.physics.pause();this.add.text(W/2,H/2,who+" WINS!",{fontSize:"40px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  update(){if(this.over)return;
    this.pad1.body.setVelocityX(this.k.a.isDown?-350:this.k.d.isDown?350:0);
    this.pad2.body.setVelocityX(this.k.left.isDown?-350:this.k.right.isDown?350:0);
    this.pad1.x=Phaser.Math.Clamp(this.pad1.x,40,W/2-40);
    this.pad2.x=Phaser.Math.Clamp(this.pad2.x,W/2+40,W-40);
    if(this.ball1.y>H-10){this.ball1.setPosition(W/4,H-50);this.ball1.body.setVelocity(Phaser.Math.Between(-150,150),-250);}
    if(this.ball2.y>H-10){this.ball2.setPosition(W*3/4,H-50);this.ball2.body.setVelocity(Phaser.Math.Between(-150,150),-250);}
    this.sTxt.setText("P1: "+this.s1+"/18 | P2: "+this.s2+"/18");
  }
});
